/** /api/me refresh cascade: invalidating apps / clients / warehouses queries also invalidates ["me"] (admin-settings REQ-F1). */
import { describe, expect, it } from 'vitest';
import { cascadesToMe, createQueryClient } from '@/lib/query-client';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('me cascade', () => {
  it('matches only the dependent key roots', () => {
    expect(cascadesToMe(['apps'])).toBe(true);
    expect(cascadesToMe(['clients', { page: 1 }])).toBe(true);
    expect(cascadesToMe(['warehouses'])).toBe(true);
    expect(cascadesToMe(['me'])).toBe(false);
    expect(cascadesToMe(['orders'])).toBe(false);
    expect(cascadesToMe([])).toBe(false);
  });

  it('invalidating an apps query marks /api/me stale; unrelated keys do not', async () => {
    const client = createQueryClient();
    client.setQueryData(['me'], { ok: 1 });
    client.setQueryData(['apps'], []);
    client.setQueryData(['orders'], []);

    await client.invalidateQueries({ queryKey: ['orders'] });
    await tick();
    expect(client.getQueryState(['me'])?.isInvalidated).toBe(false);

    await client.invalidateQueries({ queryKey: ['apps'] });
    await tick();
    expect(client.getQueryState(['me'])?.isInvalidated).toBe(true);
  });
});
