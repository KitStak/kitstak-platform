import { describe, expect, it } from 'vitest';
import { shortScopeLabel, shortTriggerLabel } from '@/lib/grid-defs/integrations/workflows';

describe('workflow grid compact labels', () => {
  it('shortens trigger names', () => {
    expect(shortTriggerLabel('Shipment Order Created')).toBe('Order created');
    expect(shortTriggerLabel('Shipment Order Imported')).toBe('Order imported');
    expect(shortTriggerLabel('Purchase Order Created')).toBe('PO created');
    expect(shortTriggerLabel('Order Shipped')).toBe('Order shipped');
    expect(shortTriggerLabel('Custom')).toBe('Custom');
  });
  it('compacts scope', () => {
    expect(shortScopeLabel(null, null)).toBe('All WH · All clients');
    expect(shortScopeLabel('MLT1', 'Acme')).toBe('MLT1 · Acme');
  });
});
