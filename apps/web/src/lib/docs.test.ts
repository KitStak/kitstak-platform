/**
 * Guards for kitstak.com/docs (content/docs/README.md): the Markdown dialect, and every page's front
 * matter, sections, links and wording. A failure names the file and what to fix.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCT_IDS, ROUTES } from '@/components/site-links';
import { CATALOG, TRIAL_DAYS, listPrice } from '@/lib/pricing';
import { allDocPages, docApps, loadDocs } from './docs/docs';
import type { DocBlock } from './docs/markdown';
import { parseMarkdown, plainText, slugify, splitFrontMatter } from './docs/markdown';

describe('docs markdown', () => {
  it('reads front matter and strips quotes', () => {
    const { data, body } = splitFrontMatter('---\ntitle: "Receive a PO"\norder: 20\n---\n\nHello');
    expect(data).toEqual({ title: 'Receive a PO', order: '20' });
    expect(body.trim()).toBe('Hello');
  });

  it('parses every block the guide allows', () => {
    const blocks = parseMarkdown(
      [
        '## Before you start',
        '',
        'One line',
        'and its second line.',
        '',
        '- first',
        '- second',
        '  continued',
        '',
        '1. Go to **Inbound**.',
        '2. Select **Receive**.',
        '',
        '| Field | Required |',
        '| --- | --- |',
        '| SKU | Yes |',
        '',
        '> **Tip:** Scan, do not type.',
        '',
        '```csv',
        'sku,qty',
        '```',
        '',
        '### Before you start',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual(['h2', 'p', 'ul', 'ol', 'table', 'callout', 'code', 'h3']);
    expect(blocks[1]).toEqual({ type: 'p', text: 'One line and its second line.' });
    expect(blocks[2]).toEqual({ type: 'ul', items: ['first', 'second continued'] });
    expect(blocks[4]).toEqual({ type: 'table', head: ['Field', 'Required'], rows: [['SKU', 'Yes']] });
    expect(blocks[5]).toEqual({ type: 'callout', kind: 'tip', text: 'Scan, do not type.' });
    expect(blocks[6]).toEqual({ type: 'code', lang: 'csv', code: 'sku,qty' });
    // Repeated headings get unique anchors.
    expect([blocks[0], blocks[7]].map((b) => (b as { id: string }).id)).toEqual([
      'before-you-start',
      'before-you-start-2',
    ]);
  });

  it('makes anchors and plain text', () => {
    expect(slugify('Pick, pack **and** ship')).toBe('pick-pack-and-ship');
    expect(plainText('Go to **Inbound** and see [receiving](/docs/wms/x) with `PO-1`.')).toBe(
      'Go to Inbound and see receiving with PO-1.',
    );
  });
});

/* Every page */

const pages = allDocPages();

function blockText(block: DocBlock): string {
  switch (block.type) {
    case 'ul':
    case 'ol':
      return block.items.join('\n');
    case 'table':
      return [...block.head, ...block.rows.flat()].join('\n');
    case 'code':
      return block.code;
    default:
      return block.text;
  }
}

function pageText(page: (typeof pages)[number]): string {
  return [page.title, page.description, ...page.blocks.map(blockText)].join('\n');
}

const SITE_PATHS = new Set<string>([
  ...Object.values(ROUTES).map((r) => r.split(/[?#]/)[0] ?? r),
  '/docs',
  '/articles',
  '/customers',
  '/customers/team-1',
]);

const DOC_PATHS = new Set<string>([...docApps().map((a) => a.path), ...pages.map((p) => p.path)]);

describe('docs content', () => {
  it('has pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('has no file problems', () => {
    expect(loadDocs().problems).toEqual([]);
  });

  it.each(docApps().map((a) => [a.id, a]))('%s: titles are unique', (_id, app) => {
    const titles = app.pages.map((p) => p.title.toLowerCase());
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it('every title and description fits a search result', () => {
    const bad = pages
      .filter((p) => p.title.length > 90 || p.description.length < 40 || p.description.length > 220)
      .map((p) => `${p.file}: title ${p.title.length}, description ${p.description.length}`);
    expect(bad).toEqual([]);
  });

  it('every internal link resolves', () => {
    const broken: string[] = [];
    for (const page of pages) {
      for (const match of pageText(page).matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const target = (match[1] ?? '').split(/[?#]/)[0] ?? '';
        const clean = target.replace(/\/$/, '') || '/';
        if (!DOC_PATHS.has(clean) && !SITE_PATHS.has(clean)) broken.push(`${page.file} -> ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('uses no em dash, en dash or double dash', () => {
    const bad = pages.filter((p) => /[—–]|\s--\s/.test(pageText(p))).map((p) => p.file);
    expect(bad).toEqual([]);
  });

  it('writes no KitStak list price, discount or trial length', () => {
    const prices = PRODUCT_IDS.map((id) => listPrice(id));
    const discount = new RegExp(
      `\\b(${CATALOG.bundlePercentOff}|${CATALOG.yearlyPercentOff})% off|save (${CATALOG.bundlePercentOff}|${CATALOG.yearlyPercentOff})%`,
      'i',
    );
    const trial = new RegExp(`\\b${TRIAL_DAYS}[- ]day`, 'i');
    const bad = pages
      .filter((p) => {
        // Pulse worked examples use made-up money for a customer's own job; they never name a KitStak plan.
        const text = pageText(p);
        const kitstakPrice =
          p.app !== 'pulse' && prices.some((price) => new RegExp(`\\${price}(?![\\d,.])`).test(text));
        return kitstakPrice || discount.test(text) || trial.test(text);
      })
      .map((p) => p.file);
    expect(bad).toEqual([]);
  });
});
