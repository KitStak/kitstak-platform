import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPermissionKey } from '@/server/auth/permission-catalog';
import { backgroundTasks } from '@/server/db/schema';
import {
  buildListSearch,
  createGenericProvider,
  createHttpListFetcher,
  parseListResponse,
} from '@/server/exports/generic';
import { GRID_EXPORTS, getGridExportDef } from '@/server/exports/grid-keys';
import { getModuleExportProvider, registeredProviderKeys } from '@/server/exports/providers';
import {
  exportFileName,
  failStaleExports,
  listExportHistory,
  queueExport,
  runExport,
} from '@/server/exports/runner';
import type { ExportProvider } from '@/server/exports/types';
import {
  buildXlsx,
  inferColumnType,
  inferColumns,
  readPath,
  safeSheetName,
  toCellValue,
} from '@/server/exports/xlsx';
import { authFor, seededDb, tempStore, type SeededDb, type TempStore } from './fixtures';

function gridDef(gridKey: string): NonNullable<ReturnType<typeof getGridExportDef>> {
  const def = getGridExportDef(gridKey);
  if (!def) throw new Error(`missing grid export def ${gridKey}`);
  return def;
}

async function loadSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('no sheet');
  return sheet;
}

describe('grid export registry', () => {
  it('every gridKey is unique, has a provider stub and a real view permission', () => {
    const keys = GRID_EXPORTS.map((d) => d.gridKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...registeredProviderKeys()].sort()).toEqual([...keys].sort());
    for (const def of GRID_EXPORTS) {
      expect(isPermissionKey(def.permission), def.permission).toBe(true);
      expect(def.listPath.startsWith('/api/')).toBe(true);
      expect(fs.existsSync(`src/server/exports/providers/${def.gridKey}.ts`)).toBe(true);
      // Each grid either keeps the null stub (generic list export) or a module ships a real provider.
      const provider = getModuleExportProvider(def.gridKey);
      if (provider !== null) expect(typeof provider.fetchPage, def.gridKey).toBe('function');
    }
    expect(getGridExportDef('orders-shipped')?.fixedParams).toEqual({ tab: 'shipped' });
  });
});

describe('xlsx writer', () => {
  it('infers types and converts cells', () => {
    expect(inferColumnType([1, 2, null])).toBe('integer');
    expect(inferColumnType([1.5, 2])).toBe('number');
    expect(inferColumnType([true, false])).toBe('boolean');
    expect(inferColumnType(['2026-11-05T10:00:00.000Z'])).toBe('datetime');
    expect(inferColumnType(['2026-11-05'])).toBe('date');
    expect(inferColumnType(['x', 1])).toBe('text');
    expect(toCellValue(true, 'boolean')).toBe('Yes');
    expect(toCellValue(1.005, 'money')).toBe(1);
    expect(toCellValue('abc', 'integer')).toBe('abc');
    expect(toCellValue({ a: 1 }, 'text')).toBe('{"a":1}');
    expect(toCellValue('2026-11-05', 'date')).toBeInstanceOf(Date);
    expect(readPath({ client: { name: 'Acme' } }, 'client.name')).toBe('Acme');
    expect(safeSheetName('a/b:c*?[x]'.repeat(5)).length).toBeLessThanOrEqual(31);
    expect(inferColumns([{ code: 'A', nested: { x: 1 }, qtyOnHand: 2 }]).map((c) => c.label)).toEqual([
      'Code',
      'Qty On Hand',
    ]);
  });

  it('writes a frozen, filtered, typed header sheet', async () => {
    const bytes = await buildXlsx({
      name: 'Orders',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'qty', label: 'Qty', type: 'integer' },
        { key: 'at', label: 'Created', type: 'datetime' },
      ],
      rows: [{ code: 'SO1', qty: 3, at: '2026-11-05T10:00:00.000Z' }],
    });
    const sheet = await loadSheet(bytes);
    expect(sheet.name).toBe('Orders');
    expect(sheet.getRow(1).getCell(1).value).toBe('Code');
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.getRow(2).getCell(2).value).toBe(3);
    expect(sheet.getRow(2).getCell(3).value).toBeInstanceOf(Date);
    expect(sheet.getColumn(3).numFmt).toContain('h:mm');
  });
});

describe('generic provider', () => {
  it('builds the list query without paging params and with fixed params', () => {
    const search = buildListSearch(
      { fixedParams: { tab: 'shipped' } },
      '?f.status=in:Open&page=4&ps=100&sort=-code',
      2,
      1000,
    );
    expect(search.get('f.status')).toBe('in:Open');
    expect(search.get('tab')).toBe('shipped');
    expect(search.get('page')).toBe('2');
    expect(search.get('ps')).toBe('1000');
  });

  it('parses list envelopes and maps failures', () => {
    expect(
      parseListResponse({ success: true, data: [{ a: 1 }], meta: { total: 1, page: 1 } }, '/api/x'),
    ).toEqual({ rows: [{ a: 1 }], total: 1 });
    expect(() =>
      parseListResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, '/api/x'),
    ).toThrow(/Forbidden/);
    expect(() => parseListResponse({ hello: 1 }, '/api/x')).toThrow(/did not return a list/);
  });

  it('http fetcher forwards the cookie and refuses non-api paths', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    );
    const fetcher = createHttpListFetcher({
      origin: 'http://localhost:3000',
      cookie: 'ks_session=abc',
      fetchImpl,
    });
    await fetcher('/api/orders', new URLSearchParams('page=1'));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://localhost:3000/api/orders?page=1');
    expect((init.headers as Record<string, string>).cookie).toBe('ks_session=abc');
    await expect(fetcher('https://evil.example/api', new URLSearchParams())).rejects.toThrow(/\/api path/);
  });
});

describe('export runner', () => {
  let testDb: SeededDb;
  let temp: TempStore;
  beforeEach(async () => {
    testDb = await seededDb();
    temp = tempStore();
  });
  afterEach(async () => {
    await testDb.close();
    temp.cleanup();
  });

  it('queues, validates gridKey/permission/query', async () => {
    const admin = await authFor(testDb, testDb.ids.admin);
    await expect(
      async () => await queueExport(testDb.db, { auth: admin, gridKey: 'nope', query: '' }),
    ).rejects.toThrow(/Unknown grid/);
    await expect(
      async () =>
        await queueExport(testDb.db, { auth: admin, gridKey: 'orders-backlog', query: 'f.code=zz:1' }),
    ).rejects.toThrow(/Invalid export query/);
    const viewer = { ...(await authFor(testDb, testDb.ids.viewer)), permissions: new Set<string>() };
    await expect(
      async () => await queueExport(testDb.db, { auth: viewer, gridKey: 'orders-backlog', query: '' }),
    ).rejects.toThrow(/permission/);
    const task = await queueExport(testDb.db, {
      auth: admin,
      gridKey: 'orders-backlog',
      query: 'f.status=in:Open',
    });
    expect(task).toMatchObject({
      kind: 'export',
      status: 'queued',
      gridKey: 'orders-backlog',
      title: 'Shipment Orders export',
    });
  });

  it('pages through the generic provider, writes the file and completes the task', async () => {
    const admin = await authFor(testDb, testDb.ids.admin);
    const task = await queueExport(testDb.db, {
      auth: admin,
      gridKey: 'orders-backlog',
      query: 'f.status=in:Open',
    });
    const pages = [
      Array.from({ length: 1000 }, (_, i) => ({ code: `SO${i}`, qty: i })),
      [{ code: 'SOX', qty: 1 }],
    ];
    const listFetcher = vi.fn(async (_path: string, search: URLSearchParams) => {
      const page = Number(search.get('page'));
      return { success: true, data: pages[page - 1] ?? [], meta: { total: 1001 } };
    });
    // Exercise the generic provider explicitly: orders-backlog now ships its own module provider.
    const provider = createGenericProvider(gridDef('orders-backlog'));
    const done = await runExport(testDb.db, task.id, {
      auth: admin,
      listFetcher,
      provider,
      store: temp.store,
      columns: [{ key: 'code', label: 'Order' }],
    });
    expect(done).toMatchObject({ status: 'completed', progress: 100, rowCount: 1001 });
    expect(listFetcher).toHaveBeenCalledTimes(2);
    const { record, bytes } = await temp.store.read(testDb.db, done.fileId ?? '');
    expect(record.name).toMatch(/^Shipment Orders \d{4}-\d{2}-\d{2} \d{4}\.xlsx$/);
    const sheet = await loadSheet(bytes);
    expect(sheet.rowCount).toBe(1002);
    expect(sheet.getRow(1).getCell(1).value).toBe('Order');
    const history = await listExportHistory(testDb.db, { userId: testDb.ids.admin, page: 1, pageSize: 10 });
    expect(history.total).toBe(1);
    expect(history.rows[0]?.fileName).toBe(record.name);
  });

  it('records a user-safe error and never throws', async () => {
    const admin = await authFor(testDb, testDb.ids.admin);
    const task = await queueExport(testDb.db, { auth: admin, gridKey: 'products', query: '' });
    // Generic provider with no list fetcher; products ships a module provider, so pass the generic one explicitly.
    const failing = await runExport(testDb.db, task.id, {
      auth: admin,
      store: temp.store,
      provider: createGenericProvider(gridDef('products')),
    });
    expect(failing).toMatchObject({
      status: 'error',
      errorMessage: 'Export for "Products" is not configured yet',
    });

    const task2 = await queueExport(testDb.db, { auth: admin, gridKey: 'products', query: '' });
    const provider: ExportProvider = {
      fetchPage: () => {
        throw new Error('db exploded');
      },
    };
    const failed2 = await runExport(testDb.db, task2.id, { auth: admin, store: temp.store, provider });
    expect(failed2.errorMessage).toBe('The export failed. Please try again.');
    // a second run of a finished task is a no-op
    expect((await runExport(testDb.db, task2.id, { auth: admin, store: temp.store, provider })).status).toBe(
      'error',
    );
  });

  it('uses a module provider when one is given and fails stale tasks', async () => {
    const admin = await authFor(testDb, testDb.ids.admin);
    const task = await queueExport(testDb.db, { auth: admin, gridKey: 'clients', query: '' });
    const provider: ExportProvider = {
      columns: [{ key: 'name', label: 'Name' }],
      fetchPage: () => ({ rows: [{ name: 'Acme' }] }),
    };
    expect((await runExport(testDb.db, task.id, { auth: admin, store: temp.store, provider })).rowCount).toBe(
      1,
    );

    await testDb.db
      .insert(backgroundTasks)
      .values({
        kind: 'export',
        title: 'old',
        userId: testDb.ids.admin,
        status: 'started',
        createdAt: '2020-01-01T00:00:00.000Z',
      });
    expect(await failStaleExports(testDb.db, new Date('2021-01-01T00:00:00.000Z'))).toBe(1);
    expect(exportFileName('X', new Date('2026-11-05T09:07:00.000Z'))).toBe('X 2026-11-05 0907.xlsx');
  });

  it('generic provider without a fetcher reports not configured', async () => {
    const def = getGridExportDef('users');
    if (!def) throw new Error('missing');
    const provider = createGenericProvider(def);
    const ctx = {
      db: testDb.db,
      auth: await authFor(testDb, testDb.ids.admin),
      gridKey: 'users',
      query: { qm: 'sw' as const, filters: [], sort: [], page: 1, pageSize: 100 },
      rawQuery: '',
    };
    await expect(Promise.resolve().then(() => provider.fetchPage(ctx, 1, 10))).rejects.toThrow(
      /not configured/,
    );
  });
});
