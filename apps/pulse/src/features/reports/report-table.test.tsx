/**
 * The report table on a small screen: a phone gets one card per row with the answer numbers
 * first, and from 768 px Cost, Profit and Job margin are pinned to the right edge of the table.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportColumnDTO, ReportDTO } from '@/lib/types';
import { ReportTable } from './report-table';

const col = (key: string, label: string, kind: ReportColumnDTO['kind'], money = false): ReportColumnDTO => ({ key, label, kind, money }) as ReportColumnDTO;

const columns: ReportColumnDTO[] = [
  col('job', 'Job', 'text'),
  col('name', 'Name', 'text'),
  col('client', 'Client', 'text'),
  col('revenue', 'Revenue', 'money', true),
  col('labor', 'Labor', 'money', true),
  col('material', 'Material', 'money', true),
  col('cost', 'Cost', 'money', true),
  col('profit', 'Profit', 'money', true),
  col('margin', 'Job margin', 'percent', true),
  col('units', 'Units', 'number'),
];

const report = (moneyHidden = false): Pick<ReportDTO, 'columns' | 'rows' | 'total' | 'moneyHidden'> => ({
  columns,
  rows: [{ id: 'a', href: '/jobs/J-1', cells: { job: 'J-1', name: 'Gift kit', client: 'Acme', revenue: moneyHidden ? null : 100000, labor: moneyHidden ? null : 40000, material: null, cost: moneyHidden ? null : 60000, profit: moneyHidden ? null : 40000, margin: moneyHidden ? null : 4000, units: 500 } }],
  total: { job: null, revenue: moneyHidden ? null : 100000, cost: moneyHidden ? null : 60000, profit: moneyHidden ? null : 40000, margin: moneyHidden ? null : 4000, units: 500 },
  moneyHidden,
});

const cardsOf = (html: string): string => html.slice(html.indexOf('data-testid="report-cards"'), html.indexOf('</ul>'));
const labelsOf = (card: string): string[] => [...card.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((match) => match[1] ?? '');

describe('ReportTable', () => {
  it('phone cards lead with revenue and the answer columns, and leave out blank cells', () => {
    const html = renderToStaticMarkup(<ReportTable report={report()} />);
    const cards = cardsOf(html);
    const [row, total] = cards.split('data-testid="report-card-total"');
    expect(labelsOf(row ?? '')).toEqual(['Revenue', 'Cost', 'Profit', 'Job margin', 'Name', 'Client', 'Labor', 'Units']);
    expect(row).toContain('href="/jobs/J-1"');
    expect(row).toContain('$1,000.00');
    expect(labelsOf(total ?? '')).toEqual(['Revenue', 'Cost', 'Profit', 'Job margin', 'Units']);
    // The cards are for phones only, and print always uses the table.
    expect(html).toMatch(/<ul class="[^"]*md:hidden print:hidden[^"]*"[^>]*data-testid="report-cards"/);
    expect(html).toMatch(/<div class="hidden md:block print:block">/);
  });

  it('pins Profit and Job margin from 768 px, and Cost too from 1024 px, each with its own offset', () => {
    const html = renderToStaticMarkup(<ReportTable report={report()} />);
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const pinned = [...head.matchAll(/<th[^>]*style="right:([^"]+)"[^>]*class="([^"]*)"[^>]*>|<th[^>]*class="([^"]*)"[^>]*style="right:([^"]+)"[^>]*>/g)].map((match) => ({ right: (match[1] ?? match[4] ?? '').replace(/\s+/g, ''), className: match[2] ?? match[3] ?? '' }));
    expect(pinned.map((item) => item.right)).toEqual(['calc(var(--pin-w)*2)', 'calc(var(--pin-w)*1)', 'calc(var(--pin-w)*0)']);
    // On a tablet Cost scrolls with the rest, so the other columns keep about half the box (round four, designer issue 6).
    expect(pinned[0]?.className).toContain('lg:sticky');
    expect(pinned[0]?.className).not.toContain('md:sticky');
    for (const item of pinned.slice(1)) expect(item.className).toContain('md:sticky');
    for (const item of pinned) expect(item.className).toContain('[--pin-w:116px]');
  });

  it('a reader without money sees Hidden in the cards, never a blank that looks like zero', () => {
    const cards = cardsOf(renderToStaticMarkup(<ReportTable report={report(true)} />));
    expect(labelsOf(cards.split('data-testid="report-card-total"')[0] ?? '')).toEqual(['Revenue', 'Cost', 'Profit', 'Job margin', 'Name', 'Client', 'Labor', 'Material', 'Units']);
    expect(cards).toContain('Hidden');
    expect(cards).not.toContain('$');
  });
});
