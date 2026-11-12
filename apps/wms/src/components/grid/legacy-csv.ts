/**
 * Client-side CSV export of the visible page — kept only for legacy grids that have
 * not adopted a `gridKey` yet (those get the async Export As Excel instead).
 */
import type { ColumnDef } from '@tanstack/react-table';

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function readPath(row: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      row,
    );
}

export function buildCsv<T>(rows: readonly T[], columns: readonly ColumnDef<T, unknown>[]): string {
  const exportable = columns.filter(
    (c) => typeof c.header === 'string' && 'accessorKey' in c && typeof c.accessorKey === 'string',
  );
  const headers = exportable.map((c) => csvEscape(c.header));
  const keys = exportable.map((c) => ('accessorKey' in c ? String(c.accessorKey) : ''));
  return [
    headers.join(','),
    ...rows.map((row) => keys.map((k) => csvEscape(readPath(row, k))).join(',')),
  ].join('\n');
}

export function exportCsv<T>(
  rows: readonly T[],
  columns: readonly ColumnDef<T, unknown>[],
  name: string,
): void {
  const blob = new Blob([buildCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
