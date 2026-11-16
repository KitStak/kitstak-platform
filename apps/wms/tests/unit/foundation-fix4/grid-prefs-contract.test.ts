import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  call,
  closeWorld,
  cookieFor,
  current,
  openWorld,
  removeFilesRoot,
  req,
} from '../foundation-f7/harness';
import { defaultGridPrefs } from '@/components/grid/grid-prefs';
import { gridPrefsPutBody } from '@/components/grid/use-grid-prefs';

vi.mock('@/server/api/db', () => {
  const get = async () => current().db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const prefsRoute = await import('@/app/api/grid-prefs/[gridKey]/route');

const COLUMNS = [
  { id: 'select', defaultVisible: true, alwaysVisible: true },
  { id: 'expand', defaultVisible: true, alwaysVisible: true },
  { id: 'code', defaultVisible: true, alwaysVisible: false },
  { id: 'status', defaultVisible: true, alwaysVisible: false },
  { id: 'notes', defaultVisible: false, alwaysVisible: false },
  { id: 'actions', defaultVisible: true, alwaysVisible: true },
] as const;

beforeEach(async () => {
  await openWorld();
});
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

describe('grid prefs client/server contract', () => {
  const params = { gridKey: 'dev-ui-orders' };
  const url = '/api/grid-prefs/dev-ui-orders';

  it('accepts the exact body the hook builds (density toggle, resize, pin) and round-trips it', async () => {
    const cookie = await cookieFor(current().userId);
    const next = {
      ...defaultGridPrefs(COLUMNS),
      density: 'Large' as const,
      widths: { code: 141.6 },
      pinned: ['code'],
    };
    const body = gridPrefsPutBody(next);
    const put = await call(prefsRoute.PUT, req('PUT', url, { cookie, body }), params);
    expect(put.status).toBe(200);
    const got = (await call(prefsRoute.GET, req('GET', url, { cookie }), params)).data;
    expect(got).toEqual({ ...body, widths: { code: 142 } });
  });

  it('still accepts the legacy { prefs } envelope', async () => {
    const cookie = await cookieFor(current().userId);
    const prefs = defaultGridPrefs(COLUMNS);
    const put = await call(prefsRoute.PUT, req('PUT', url, { cookie, body: { prefs } }), params);
    expect(put.status).toBe(200);
    expect((await call(prefsRoute.GET, req('GET', url, { cookie }), params)).data).toMatchObject({
      density: prefs.density,
    });
  });

  it('rejects an invalid page size with a field error', async () => {
    const cookie = await cookieFor(current().userId);
    const body = gridPrefsPutBody({ ...defaultGridPrefs(COLUMNS), pageSize: 42 });
    const put = await call(prefsRoute.PUT, req('PUT', url, { cookie, body }), params);
    expect(put.status).toBe(400);
  });
});
