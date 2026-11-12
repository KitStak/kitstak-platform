import { describe, expect, it } from 'vitest';

describe('dom project', () => {
  it('runs in jsdom with the @ alias available', async () => {
    expect(typeof window).toBe('object');
    document.body.innerHTML = '<button data-testid="x">Go</button>';
    expect(document.querySelector('[data-testid="x"]')?.textContent).toBe('Go');
    const cellValues = await import('@/server/db/schema/cell-values');
    expect(cellValues).toBeTypeOf('object');
  });
});
