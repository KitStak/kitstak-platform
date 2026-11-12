import { describe, expect, it } from 'vitest';
import {
  planCarrierFromOrders,
  planLoadingBlockReason,
  planStatusBlocks,
} from '@/lib/grid-defs/shipping/shipment-plans';

describe('loading needs Ready to Ship orders', () => {
  it('blocks while orders wait', () => {
    expect(planLoadingBlockReason(3, 1)).toBe("2 of 3 orders aren't Ready to Ship yet");
    expect(planLoadingBlockReason(0, 0)).toMatch(/Add orders/);
    expect(planLoadingBlockReason(2, 2)).toBeNull();
    expect(planStatusBlocks(2, 2)).toEqual({});
    expect(Object.keys(planStatusBlocks(2, 1))).toEqual(['Loading Started', 'Loading Completed']);
  });
});

describe('plan carrier from orders', () => {
  it('lists distinct carriers', () => {
    expect(planCarrierFromOrders(null)).toBeNull();
    expect(planCarrierFromOrders('UPS - A1,UPS - A1')).toBe('UPS - A1');
    expect(planCarrierFromOrders('UPS,FedEx,USPS,DHL')).toBe('UPS, FedEx +2');
  });
});
