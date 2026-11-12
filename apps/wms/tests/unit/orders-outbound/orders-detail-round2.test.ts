import { describe, expect, it } from 'vitest';
import { lineProgress, nextStepHint } from '@/components/orders/detail/order-detail-tabs';
import { summarizeErrors } from '@/components/orders/wizard/order-wizard-shell';

const line = (q: number, a = 0, p = 0, k = 0, s = 0, c = 0) => ({
  quantity: q,
  allocatedQuantity: a,
  pickedQuantity: p,
  packedQuantity: k,
  shippedQuantity: s,
  cancelledQuantity: c,
});

describe('order detail round 2', () => {
  it('totals line progress and the open quantity', () => {
    const t = lineProgress([line(10, 4, 2), line(5, 0, 0, 0, 3, 1)]);
    expect(t).toMatchObject({
      ordered: 15,
      allocated: 4,
      picked: 2,
      shipped: 3,
      cancelled: 1,
      toAllocate: 7,
    });
    expect(lineProgress([line(2, 3)]).toAllocate).toBe(0);
  });

  it('next-step hint agrees with status, jobs and pick tasks', () => {
    const base = { jobs: [], hasPickTask: false, shipments: [] };
    expect(nextStepHint({ ...base, order: { status: 'Ready to Pick' } })).toMatch(/Create a picking job/);
    expect(
      nextStepHint({
        ...base,
        jobs: [{ id: 'j', code: 'J1', jobType: 'Single', status: 'Pending' }],
        order: { status: 'Ready to Pick' },
      }),
    ).toMatch(/Release it/);
    expect(nextStepHint({ ...base, order: { status: 'Ready to Ship' } })).toMatch(/Create a shipping label/);
    expect(nextStepHint({ ...base, order: { status: 'Shipped' } })).toBeNull();
  });

  it('flattens nested form errors into a summary', () => {
    const errors = {
      warehouseId: { type: 'step', message: 'Warehouse is required' },
      lines: [{ quantity: { type: 'step', message: 'Quantity must be at least 1' } }],
    };
    expect(summarizeErrors(errors as never)).toEqual([
      { path: 'warehouseId', message: 'Warehouse is required' },
      { path: 'lines.0.quantity', message: 'Quantity must be at least 1' },
    ]);
  });
});
