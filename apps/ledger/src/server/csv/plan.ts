/**
 * The check step of a setup import (docs/ledger/SPEC.md 7): each row of the file against what is
 * already in Ledger. A row is `create` (new), `update` (changes a record), `unchanged`, or
 * `error` (with its problems in plain words). Only the columns the file has are compared, so a
 * file with fewer columns never clears the others. Pure: the caller loads the existing records.
 */
import { blankRecord, KEY_COLUMN, readRow, rowKey, STREAMS, type Canonical, type Lookups, type RowIssue, type SetupStream } from './streams';

export interface ExistingRecord {
  readonly id: string;
  readonly record: Canonical;
  /** Archived records leave the live list but keep their name or code for history. */
  readonly archived: boolean;
  /** Accounts: the system key (posting needs the account, so its type never changes). */
  readonly systemKey?: string | null;
  /** Tax rates: an invoice line uses it, so its rate never changes. */
  readonly inUse?: boolean;
}

export interface FileRow {
  readonly rowNumber: number;
  /** Mapped cells by stream column, raw text. Only the columns the file has. */
  readonly cells: Readonly<Record<string, string>>;
}

export type PlanAction = 'create' | 'update' | 'unchanged' | 'error';

export interface PlannedRow {
  readonly rowNumber: number;
  readonly key: string;
  readonly action: PlanAction;
  readonly issues: readonly RowIssue[];
  readonly entityId: string | null;
  /** The record before (null for a new one). */
  readonly before: Canonical | null;
  /** The whole record after this row: the existing one with the file's columns laid over it. */
  readonly after: Canonical;
  /** The columns this row changes. */
  readonly changes: readonly string[];
}

function splitList(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Vendor kinds from a file are added, never taken away: the shared list may hold kinds of other apps (Crew). */
function mergeKinds(existing: string | undefined, fromFile: string | undefined, order: readonly string[]): string {
  const all = new Set([...splitList(existing), ...splitList(fromFile)]);
  return order.filter((kind) => all.has(kind)).join(', ');
}

const KEY_WORDS: Readonly<Record<SetupStream, string>> = { customers: 'customer code', vendors: 'name', items: 'item code', accounts: 'account number', tax_rates: 'name' };

const KIND_ORDER = ['supplier', 'carrier', 'temp_agency', 'landlord', 'utility', 'service', 'other'];

function streamChecks(stream: SetupStream, after: Canonical, match: ExistingRecord | undefined, fileRecord: Canonical): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!match) return issues;
  if (stream === 'accounts' && match.systemKey && fileRecord.type && fileRecord.type !== match.record.type) {
    issues.push({ column: 'type', message: `Account ${match.record.account_number} is used by Ledger, so its type stays ${match.record.type}.` });
  }
  if (stream === 'tax_rates' && match.inUse && fileRecord.rate_pct && fileRecord.rate_pct !== match.record.rate_pct) {
    issues.push({ column: 'rate_pct', message: `${match.record.name} is used on invoices, so its rate cannot change. Add a new rate with a new name and archive this one.` });
  }
  if (stream === 'customers' && match.record.customer_code.toLowerCase() !== (after.customer_code ?? '').toLowerCase()) {
    issues.push({ column: 'customer_code', message: `${match.record.name} already has the code ${match.record.customer_code}. Use that code, or another name.` });
  }
  return issues;
}

/** Plans every row of one file. Rows are matched by their key (SPEC 7.1); customers fall back to the name. */
export function planRows(stream: SetupStream, rows: readonly FileRow[], existing: readonly ExistingRecord[], lookups: Lookups): PlannedRow[] {
  const live = existing.filter((row) => !row.archived);
  const byKey = new Map(live.map((row) => [rowKey(stream, row.record), row]));
  const archivedKeys = new Map(existing.filter((row) => row.archived).map((row) => [rowKey(stream, row.record), row]));
  const byName = stream === 'customers' ? new Map(live.map((row) => [(row.record.name ?? '').toLowerCase(), row])) : new Map<string, ExistingRecord>();
  const fileAccounts = new Set(stream === 'accounts' ? rows.map((row) => (row.cells.account_number ?? '').trim().toLowerCase()).filter(Boolean) : []);
  const seen = new Map<string, number>();
  const columns = STREAMS[stream].columns.map((column) => column.key);

  return rows.map((row) => {
    const { record, issues: readIssues } = readRow(stream, row.cells, lookups, fileAccounts);
    const issues: RowIssue[] = [...readIssues];
    const key = rowKey(stream, record);
    let match = key ? byKey.get(key) : undefined;
    if (!match && stream === 'customers' && record.name) match = byName.get(record.name.toLowerCase());
    if (key) {
      const first = seen.get(key);
      if (first !== undefined) issues.push({ column: null, message: `Row ${first} has the same ${KEY_WORDS[stream]}. Each record goes in one row.` });
      else seen.set(key, row.rowNumber);
    }
    if (!match && key && archivedKeys.has(key)) {
      issues.push({ column: null, message: `${record.name || key.toUpperCase()} is archived. Bring it back in Ledger first.` });
    }
    const base = match?.record ?? blankRecord(stream);
    const merged: Record<string, string> = { ...base, ...record };
    if (stream === 'vendors') merged.kinds = mergeKinds(base.kinds, record.kinds, KIND_ORDER);
    // A key that differs only in case is the same record: keep its spelling.
    const keyColumn = KEY_COLUMN[stream];
    if (match && (match.record[keyColumn] ?? '').toLowerCase() === (merged[keyColumn] ?? '').toLowerCase()) merged[keyColumn] = match.record[keyColumn] ?? '';
    issues.push(...streamChecks(stream, merged, match, record));
    const changes = match ? columns.filter((column) => (match.record[column] ?? '') !== (merged[column] ?? '')) : columns.filter((column) => (merged[column] ?? '') !== '');
    const action: PlanAction = issues.length > 0 ? 'error' : !match ? 'create' : changes.length === 0 ? 'unchanged' : 'update';
    return { rowNumber: row.rowNumber, key, action, issues, entityId: match?.id ?? null, before: match?.record ?? null, after: merged, changes };
  });
}
