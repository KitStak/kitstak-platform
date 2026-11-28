import { ARTICLES } from '@/components/articles/articles-content';
import { docApps } from '@/lib/docs/docs';
import { SITE_URL } from '@/lib/seo';

export const dynamic = 'force-static';

/** A plain map of the site for AI assistants and answer engines (llmstxt.org). */
export function GET(): Response {
  const pages: readonly [string, string, string][] = [
    [
      'KitStak WMS',
      '/wms',
      'Warehouse management: receiving, locations, counts, pick, pack, ship, returns and 3PL client billing.',
    ],
    ['KitStak CRM', '/crm', 'Accounts, pipelines, boards, automations and dashboards.'],
    ['KitStak Projects', '/projects', 'Plans, tasks and timelines linked to CRM deals and WMS orders.'],
    ['KitStak Pulse', '/pulse', 'Profit by job, client and extra service.'],
    ['KitStak Crew (coming soon)', '/crew', 'People, shifts, a time clock, attendance, skills and labor planning for the floor. Not available yet.'],
    ['KitStak Ledger (coming soon)', '/ledger', 'Invoices, collections, vendor bills, expenses, bank reconciliation and month-end close. Not available yet.'],
    ['Pricing', '/pricing', 'Prices for each app, the bundle discount and how billing works.'],
    ['Compare products', '/products', 'All four apps side by side.'],
    [
      'Customer story: Team 1',
      '/customers/team-1',
      'How Team 1 moved 28 boards and 210 items off monday.com in one day.',
    ],
    ['Docs', '/docs', 'Step by step guides for every feature in every app.'],
    ['Security', '/security', 'How KitStak protects accounts, data and payments.'],
    ['Contact', '/contact', 'Talk to the founder or book a walkthrough.'],
  ];
  const lines = [
    '# KitStak',
    '',
    '> KitStak runs a CRM, a WMS, Projects and Pulse on one database and one sign-in. Use one app or any mix. Crew (people and shifts) and Ledger (invoices and bills) are coming soon. Built for warehouses, 3PLs and operations teams.',
    '',
    '## Products and company',
    '',
    ...pages.map(([name, path, note]) => `- [${name}](${SITE_URL}${path}): ${note}`),
    '',
    '## Docs',
    '',
    ...docApps().flatMap((app) => [
      `### ${app.title}`,
      '',
      ...app.pages.map((p) => `- [${p.title}](${SITE_URL}${p.path}): ${p.description}`),
      '',
    ]),
    '## Articles',
    '',
    ...ARTICLES.map((a) => `- [${a.title}](${SITE_URL}/articles/${a.slug}): ${a.description}`),
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
