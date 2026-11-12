// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, apiRequest, buildUrl, resetApiClientForTests } from '@/lib/api-client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetApiClientForTests();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps the success envelope and keeps meta', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { success: true, data: [{ id: 1 }], meta: { total: 1, page: 1, pageSize: 100 } }),
    );
    const res = await apiRequest<{ id: number }[]>('/api/orders', {
      query: { q: 'SO', page: 2, empty: '', list: ['a', 'b'] },
    });
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.meta?.total).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/orders?q=SO&page=2&list=a&list=b');
  });

  it('throws ApiError with code, status and field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        success: false,
        error: 'Invalid input',
        code: 'VALIDATION',
        fieldErrors: { name: ['Required'] },
        requestId: 'r1',
      }),
    );
    const err = await apiFetch('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect([apiErr.code, apiErr.status, apiErr.message, apiErr.requestId]).toEqual([
      'VALIDATION',
      400,
      'Invalid input',
      'r1',
    ]);
    expect(apiErr.fieldMessage('name')).toBe('Required');
  });

  it('mutations carry no CSRF token header (retired — same-origin check server-side)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { ok: true } }));
    await apiFetch('/api/x', { method: 'POST', body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe('same-origin');
  });

  it('redirects to login on 401 unless suppressed', async () => {
    window.history.pushState({}, '', '/orders?tab=open');
    let assigned = '';
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        pathname: '/orders',
        search: '?tab=open',
        set href(v: string) {
          assigned = v;
        },
        get href() {
          return assigned;
        },
      },
    });
    try {
      fetchMock.mockResolvedValueOnce(
        json(401, { success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }),
      );
      await expect(apiFetch('/api/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
      expect(assigned).toBe('/login?next=%2Forders%3Ftab%3Dopen');
      assigned = '';
      fetchMock.mockResolvedValueOnce(json(401, { success: false, error: 'x', code: 'UNAUTHENTICATED' }));
      await expect(apiFetch('/api/me', { skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
      expect(assigned).toBe('');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('maps network failures and non-JSON responses', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502 }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('builds URLs with existing query strings', () => {
    expect(buildUrl('/api/x?a=1', { b: 2 })).toBe('/api/x?a=1&b=2');
    expect(buildUrl('/api/x', '?f.status=in:Open')).toBe('/api/x?f.status=in:Open');
  });
});
