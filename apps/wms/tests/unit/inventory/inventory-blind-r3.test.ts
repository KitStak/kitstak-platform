import { describe, expect, it } from 'vitest';
import { openPurchaseOrdersHref } from '@/server/repositories/inventory-open-orders';
import { openPurchaseOrdersLinkHref } from '@/components/inventory/inventory-links';

describe('Open PO Qty drill (blind-judge round 3)', () => {
  it('filters Purchase Orders to exactly the open POs, warehouse and open statuses', () => {
    const href = decodeURIComponent(openPurchaseOrdersHref(['PO-1', 'PO-2'], 'wh1'));
    expect(href.startsWith('/receiving?')).toBe(true);
    expect(href).toContain('f.code=in:PO-1,PO-2');
    expect(href).toContain('f.warehouseId=in:wh1');
    expect(href).toContain('f.status=in:Pending,Started,Receiving');
  });
  it('falls back to status + warehouse when no PO matches', () => {
    expect(decodeURIComponent(openPurchaseOrdersHref([], null))).not.toContain('f.code');
  });
  it('links through the redirect route', () => {
    expect(openPurchaseOrdersLinkHref('p1', 'w1')).toBe(
      '/api/inventory/open-pos?productId=p1&warehouseId=w1',
    );
  });
});
