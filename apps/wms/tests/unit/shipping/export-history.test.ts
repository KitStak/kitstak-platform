import { describe, expect, it } from 'vitest';
import { visibleExports } from '@/components/shipping/export-history-button';

describe('per-grid export history', () => {
  const tasks = [
    { id: 'a', gridKey: 'shipments', status: 'completed' as const },
    { id: 'b', gridKey: 'shipments', status: 'started' as const },
    { id: 'c', gridKey: 'end-of-day', status: 'completed' as const },
    { id: 'd', gridKey: 'shipments', status: 'error' as const },
  ];
  it("keeps only this grid's tasks", () => {
    expect(visibleExports(tasks, 'shipments', new Set()).map((t) => t.id)).toEqual(['a', 'b', 'd']);
  });
  it('Clear completed hides finished tasks but never running ones', () => {
    expect(visibleExports(tasks, 'shipments', new Set(['a', 'b', 'd'])).map((t) => t.id)).toEqual(['b']);
  });
});
