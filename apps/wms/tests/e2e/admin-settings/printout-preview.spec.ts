/**
 * M14 printouts — the designer's Canvas preview (`format: "record"`) returns real order data.
 * Read-only: no template is saved.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { e2eBaseUrl } from '../fixtures/roles';

test.use({ actionTimeout: 45_000, navigationTimeout: 90_000 });

const base = e2eBaseUrl();
async function headers(_page: Page): Promise<Record<string, string>> {
  // Same-origin header: the CSRF token is retired (blueprint §1.4).
  return { Origin: base };
}

const LAYOUT = {
  family: 'document',
  paper: 'Letter',
  font: 'Helvetica',
  fontSize: 10,
  logoPosition: 'left',
  accentColor: '#1F2A44',
  title: 'Packing List',
  footerText: '',
  barcodeType: 'code128',
  labelLanguage: 'PDF',
  blocks: [],
  sections: [{ key: 'header', enabled: true }],
  columns: [],
};

test('canvas preview returns 200 with format=record and a real sample order', async ({ page }) => {
  const samples = await page.request.get(`${base}/api/printouts/samples`, { timeout: 90_000 });
  expect(samples.ok()).toBeTruthy();
  const list = (await samples.json()).data as { id: string; label: string }[];
  const sampleIds = list.slice(0, 1).map((s) => s.id);
  const res = await page.request.post(`${base}/api/printouts/preview`, {
    headers: await headers(page),
    data: { typeKey: 'packing-list', layout: LAYOUT, sampleIds, format: 'record' },
    timeout: 90_000,
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()).data as {
    records: { code: string; lines: unknown[] }[];
    companyName: string;
  };
  expect(body.records.length).toBeGreaterThan(0);
  expect(body.companyName).toBeTruthy();
  if (list[0]) expect(body.records[0]?.code).toBe(list[0].label);
});

test('canvas preview rejects an unknown format with 400', async ({ page }) => {
  const res = await page.request.post(`${base}/api/printouts/preview`, {
    headers: await headers(page),
    data: { typeKey: 'packing-list', layout: LAYOUT, sampleIds: [], format: 'docx' },
    timeout: 90_000,
  });
  expect(res.status()).toBe(400);
});
