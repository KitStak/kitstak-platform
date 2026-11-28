import 'server-only';
import { findRecord, type RecordKind } from '@/server/domain/records';
import type { DomainContext } from '@/server/domain/_shared';
import { parseMonth } from '@/features/close/months';
import { REPORTS, SETTINGS_SECTIONS } from './catalog';

/** Detail routes and the record each one names (SPEC 6). `new`, `recurring` and `pay` are pages of their own. */
const RECORD_ROUTES: readonly { readonly pattern: RegExp; readonly kind: RecordKind }[] = [
  { pattern: /^\/invoices\/recurring\/([^/]+)$/, kind: 'recurring' },
  { pattern: /^\/invoices\/(?!new$|recurring$)([^/]+)$/, kind: 'invoice' },
  { pattern: /^\/customers\/(?!by-link$)([^/]+)$/, kind: 'customer' },
  { pattern: /^\/payments\/(?!new$)([^/]+)$/, kind: 'payment' },
  { pattern: /^\/bills\/(?!new$|pay$)([^/]+)$/, kind: 'bill' },
  { pattern: /^\/vendors\/([^/]+)$/, kind: 'vendor' },
  { pattern: /^\/expenses\/(?!new$)([^/]+)$/, kind: 'expense' },
  { pattern: /^\/bank\/([^/]+)(?:\/reconcile)?$/, kind: 'bank_account' },
  { pattern: /^\/journal\/(?!new$)([^/]+)$/, kind: 'journal' },
  { pattern: /^\/import\/(?!new$)([^/]+)$/, kind: 'import' },
];

/**
 * True when the address names something that is not there: an unknown report, settings section or
 * month, or a record id or number this workspace does not have. The (app) layout answers a real
 * 404 before the loading boundary starts streaming (Pulse pattern). The pages check again.
 */
export async function routeMissing(ctx: DomainContext, fullPath: string): Promise<boolean> {
  const path = (fullPath.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  const report = /^\/reports\/([^/]+)$/.exec(path);
  if (report) return !REPORTS.some((entry) => entry.slug === decodeURIComponent(report[1]!));
  const section = /^\/settings\/([^/]+)$/.exec(path);
  if (section) return !SETTINGS_SECTIONS.some((entry) => entry.slug === decodeURIComponent(section[1]!));
  const month = /^\/close\/([^/]+)$/.exec(path);
  if (month) return parseMonth(decodeURIComponent(month[1]!)) === null;
  for (const route of RECORD_ROUTES) {
    const match = route.pattern.exec(path);
    if (match) return (await findRecord(ctx, route.kind, decodeURIComponent(match[1]!))) === null;
  }
  return false;
}
