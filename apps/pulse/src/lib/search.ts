/**
 * Search over the things Pulse always has: pages, reports and CSV data streams. Pure and shared
 * by the search page. Record search (jobs, clients, services) is added to the same result shape.
 */
import { navFor, type NavId } from './nav';
import type { PulseRole } from './permissions';
import { REPORTS } from './reports';
import { routes } from './routes';
import { STREAMS } from './streams';
import { canImportStream } from './permissions';

export type SearchKind = 'page' | 'report' | 'stream';

export interface SearchHit {
  readonly kind: SearchKind;
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  /** Set for pages: which navigation icon to show. */
  readonly nav?: NavId;
}

const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Every word of the query must appear somewhere in the text. */
function matches(query: string, ...texts: readonly string[]): boolean {
  const haystack = norm(texts.join(' '));
  return norm(query)
    .split(' ')
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function searchPulse(query: string, who: { readonly role: PulseRole; readonly seesMoney: boolean }): SearchHit[] {
  if (norm(query).length === 0 || who.role === 'none') return [];
  const pages = navFor(who.role);
  const hits: SearchHit[] = [];
  for (const entry of pages) {
    if (matches(query, entry.label, entry.description, ...entry.keywords)) {
      hits.push({ kind: 'page', id: entry.id, title: entry.label, detail: entry.description, href: entry.href, nav: entry.id });
    }
  }
  if (pages.some((entry) => entry.id === 'reports')) {
    for (const report of REPORTS) {
      if (report.needsMoney && !who.seesMoney) continue;
      if (matches(query, report.name, report.description, 'report')) {
        hits.push({ kind: 'report', id: report.slug, title: report.name, detail: report.description, href: routes.report(report.slug) });
      }
    }
  }
  for (const stream of STREAMS) {
    if (!canImportStream(who.role, stream.id)) continue;
    if (matches(query, stream.name, stream.description, stream.file, 'import csv spreadsheet')) {
      hits.push({ kind: 'stream', id: stream.id, title: `Import ${stream.name.toLowerCase()}`, detail: stream.description, href: routes.newImport(stream.id) });
    }
  }
  return hits;
}
