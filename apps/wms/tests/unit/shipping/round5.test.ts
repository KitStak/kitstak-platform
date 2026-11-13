/** Parity loop round 4 (critic round 3): label guard, readiness, timeline wording, lifecycle stages, EOD time zone. */
import { describe, expect, it } from 'vitest';
import {
  deriveFromOrders,
  noActiveLabelMessage,
  orderReadiness,
  planShipBlockReason,
  reachedPlanStages,
  unlabeledLabel,
} from '@/lib/grid-defs/shipping/shipment-plans';
import { humanizePlanChange } from '@/components/shipment-plans/plan-form-model';
import { formatInZone } from '@/components/shipping/column-kit';

describe('ship label guard', () => {
  it('blocks Ship when every Ready to Ship order lacks an active label', () => {
    expect(planShipBlockReason('Open', 1, 1, 0, 1, 'SO010845')).toBe(
      'SO010845 has no active shipping label. Create a shipping label first',
    );
    expect(planShipBlockReason('Open', 3, 2, 0, 2, 'SO1,SO2')).toMatch(
      /^2 Ready to Ship orders have no active shipping label \(SO1, SO2\)/,
    );
  });
  it('allows Ship when at least one Ready to Ship order is labelled', () => {
    expect(planShipBlockReason('Open', 2, 2, 0, 1, 'SO1')).toBeNull();
  });
  it('names voided labels in the per-order message', () => {
    expect(noActiveLabelMessage('SO1', 3)).toBe(
      'SO1 has no active shipping label: all 3 labels were voided. Create a new label first.',
    );
    expect(noActiveLabelMessage('SO1', 1)).toMatch(/its label was voided/);
    expect(noActiveLabelMessage('SO1', 0)).toBe('SO1 has no active shipping label. Create a label first.');
    expect(unlabeledLabel(5, 'A,B,C,D,E')).toBe(
      '5 Ready to Ship orders have no active shipping label (A, B, C, …)',
    );
  });
});

describe('graded readiness', () => {
  it.each([
    ['Open', 'Not picked'],
    ['Ready to Pick', 'Not picked'],
    ['Picking Started', 'Picking'],
    ['Ready to Pack', 'Picked'],
    ['Packing Started', 'Packing'],
    ['Ready to Load', 'Loading'],
    ['Ready to Ship', 'Ready to ship'],
  ])('%s → %s', (status, label) => expect(orderReadiness(status).label).toBe(label));
});

describe('change-log wording', () => {
  it('humanises order and field changes', () => {
    expect(humanizePlanChange('Orders is modified.  --> SO010845')).toBe('Added order SO010845');
    expect(humanizePlanChange('Orders is modified. SO1, SO2 --> SO2, SO3')).toBe(
      'Added order SO3; removed order SO1',
    );
    expect(humanizePlanChange('Status is modified. Open --> Shipped')).toBe(
      'Status changed from Open to Shipped',
    );
    expect(humanizePlanChange('Loading Started At is modified.  --> 2026-11-10T09:26:15.767Z')).toBe(
      'Loading started set to 2026-11-10T09:26:15.767Z',
    );
    expect(humanizePlanChange('Truck Plate Number is modified. KS 1 --> ')).toBe(
      'Truck Plate Number cleared (was KS 1)',
    );
    expect(humanizePlanChange('Shipment plan X is created.')).toBe('Shipment plan X is created.');
  });
});

describe('lifecycle stages', () => {
  it('marks only stages the plan passed through', () => {
    const r = reachedPlanStages('Shipped', ['Status is modified. Open --> Shipped']);
    expect([...r].sort()).toEqual(['Open', 'Shipped']);
    const full = reachedPlanStages('Shipped', [
      'Status is modified. Open --> In Progress',
      'Status is modified. In Progress --> Loading Started',
      'Status is modified. Loading Started --> Shipped',
    ]);
    expect(full.has('In Progress') && full.has('Loading Started') && !full.has('Loading Completed')).toBe(
      true,
    );
  });
});

describe('consignee derivation (grid = detail)', () => {
  it("uses the plan's own value, else the orders' shared value", () => {
    expect(deriveFromOrders('Plan', ['A'])).toEqual({ value: 'Plan', hint: null });
    expect(deriveFromOrders(null, ['Dana', 'Dana'])).toEqual({ value: 'Dana', hint: 'from orders' });
    expect(deriveFromOrders(null, ['Dana', 'Lee']).value).toBe('Mixed (2)');
  });
});

describe('EOD close date in warehouse time', () => {
  it('prints the zone label like the PDF', () => {
    expect(formatInZone('2026-11-10T09:29:00Z', 'America/New_York')).toBe('11/10/2026 4:29 AM EST');
    expect(formatInZone(null, 'America/New_York')).toBe('None');
    expect(formatInZone('2026-11-10T09:29:00Z', 'Not/AZone')).toMatch(/^11\/10\/2026 /);
  });
});
