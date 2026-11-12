/** Downloadable error reports and browser download helpers. */
import { toCsv, UTF8_BOM } from './csv';
import type { RowIssue } from './types';

export interface ServerRowFailure {
  readonly row: number;
  readonly message: string;
}

export function buildErrorReport(
  issues: readonly RowIssue[],
  failures: readonly ServerRowFailure[] = [],
): string {
  const header = ['Row', 'Column', 'Value in file', 'Problem'];
  const rows = [
    ...issues.map((issue) => [issue.row, issue.column, issue.raw, issue.message]),
    ...failures.map((failure) => [failure.row, '', '', failure.message]),
  ].sort((a, b) => Number(a[0]) - Number(b[0]));
  return UTF8_BOM + toCsv([header, ...rows]);
}

/** Trigger a browser download for in-memory content. */
export function downloadBlob(content: BlobPart, fileName: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function baseFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported data';
}
